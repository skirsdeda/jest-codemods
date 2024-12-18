import { namedTypes } from 'ast-types'
import { ExpressionKind } from 'ast-types/gen/kinds'
import core, { API, Collection, FileInfo } from 'jscodeshift'
import path from 'path'

import finale from '../utils/finale'
import { removeRequireAndImport } from '../utils/imports'
import logger from '../utils/logger'

const MOCKERY_METHODS_TO_REMOVE = ['enable', 'disable', 'deregisterAll'] as const

function removeDefunctCalls(
  j: core.JSCodeshift,
  ast: Collection,
  mockeryExpression: string
) {
  ast
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        property: {
          type: 'Identifier',
          name: (name) => MOCKERY_METHODS_TO_REMOVE.includes(name),
        },
        object: {
          type: 'Identifier',
          name: mockeryExpression,
        },
      },
    })
    .remove()
}

function isRelativeImport(path: string): boolean {
  return path.startsWith('./') || path.startsWith('../')
}

function transformMocks(
  j: core.JSCodeshift,
  ast: Collection,
  mockeryExpression: string,
  logWarning
) {
  // get non-global imports (possibly inside beforeAll/beforeEach)
  // const nonGlobalImports = ast
  //   .find(j.ImportExpression, { source: { type: 'Literal' } })
  //   .filter((p) => !p.scope.isGlobal)
  // const nonGlobalImports = ast.filter(({ node, scope }) => {
  //   const isSuitableRequire =
  //     node.type === 'CallExpression' &&
  //     node.callee.name === 'require' &&
  //     node.arguments.length === 1 &&
  //     (node.arguments[0].type === 'Literal' ||
  //       node.arguments[0].type === 'StringLiteral') &&
  //     typeof node.arguments[0].value === 'string'
  //   const isSuitableImport =
  //     node.type === 'ImportExpression' && node.source.type === 'Literal'
  //   return (isSuitableRequire || isSuitableImport) && !scope.isGlobal
  // })
  const nonGlobalRequires = ast
    .find(j.CallExpression, { callee: { name: 'require' } })
    .filter(
      (p) =>
        p.value.arguments.length === 1 &&
        (p.value.arguments[0].type === 'Literal' ||
          p.value.arguments[0].type === 'StringLiteral') &&
        typeof p.value.arguments[0].value === 'string' &&
        !p.scope.isGlobal
    )
  // last of them is assumed to be for test subject
  const maybeSubjectPath: string | undefined =
    nonGlobalRequires.length > 0
      ? ((nonGlobalRequires.nodes().at(-1).arguments[0] as namedTypes.Literal)
          .value as string)
      : undefined

  // mockery.registerMock => jest.mock with module paths resolved to be relative to test module
  // then return resolved mocked module paths
  const mockModulePaths: Set<string> = new Set(
    ast
      .find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          property: {
            type: 'Identifier',
            name: 'registerMock',
          },
          object: {
            type: 'Identifier',
            name: mockeryExpression,
          },
        },
      })
      .filter((p) => {
        if (
          p.value.arguments.length !== 2 ||
          (p.value.arguments[0].type !== 'Literal' &&
            p.value.arguments[0].type !== 'StringLiteral') ||
          typeof p.value.arguments[0].value !== 'string'
        ) {
          logWarning(
            'Unsupported mockery registerMock found (should have 2 args, first being string literal)',
            p
          )
          return false
        }

        const mockPathArg = p.value.arguments[0] as namedTypes.Literal
        const mockPathArgValue = mockPathArg.value as string
        if (maybeSubjectPath === undefined && isRelativeImport(mockPathArgValue)) {
          logWarning(
            'Cannot resolve mockery mock path because test subject module path could not be found',
            p
          )
          return false
        }

        return true
      })
      .replaceWith((p) => {
        // if there are mocks with relative paths, we need to rebase them to be relative to test module,
        // because mockery uses relative paths as they appear in test subjest module
        const mockPathArg = p.value.arguments[0] as namedTypes.Literal
        let mockPath = mockPathArg.value as string
        if (isRelativeImport(mockPath)) {
          mockPath = path.join(path.dirname(maybeSubjectPath), mockPath)
          if (!mockPath.startsWith('.')) {
            mockPath = `./${mockPath}`
          }
        }

        return j.callExpression(
          j.memberExpression(j.identifier('jest'), j.identifier('mock')),
          [
            j.literal(mockPath),
            j.arrowFunctionExpression([], p.value.arguments[1] as ExpressionKind),
          ]
        )
      })
      .paths()
      .map((p) => (p.value.arguments[0] as namedTypes.Literal).value as string)
  )

  // change non-global requires for mocked modules to use jest.requireActual
  nonGlobalRequires
    .filter((p) =>
      mockModulePaths.has((p.value.arguments[0] as namedTypes.Literal).value as string)
    )
    .replaceWith((p) =>
      j.callExpression(
        j.memberExpression(j.identifier('jest'), j.identifier('requireActual')),
        p.value.arguments
      )
    )
}

export default function transformer(fileInfo: FileInfo, api: API, options) {
  const j = api.jscodeshift
  const ast = j(fileInfo.source)

  const mockeryExpression = removeRequireAndImport(j, ast, 'mockery')

  if (!mockeryExpression) {
    if (!options.skipImportDetection) {
      return fileInfo.source
    }
    return null
  }

  const logWarning = (msg, node) => logger(fileInfo, msg, node)

  removeDefunctCalls(j, ast, mockeryExpression)
  transformMocks(j, ast, mockeryExpression, logWarning)

  return finale(fileInfo, j, ast, options)
}
