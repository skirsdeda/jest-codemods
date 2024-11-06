import { namedTypes } from 'ast-types'
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

function transformMocks(
  j: core.JSCodeshift,
  ast: Collection,
  mockeryExpression: string,
  logWarning
) {
  // get non-global require calls (possibly inside beforeAll/beforeEach)
  const nonGlobalRequires = ast
    .find(j.CallExpression, {
      callee: { name: 'require' },
    })
    .filter(
      (p) =>
        p.value.arguments.length === 1 &&
        p.value.arguments[0].type === 'Literal' &&
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
          p.value.arguments[0].type !== 'Literal' ||
          typeof p.value.arguments[0].value !== 'string'
        ) {
          logWarning(
            'Unsupported mockery registerMock found (should have 2 args, first being string literal)',
            p
          )
          return false
        }
        return true
      })
      .forEach((p) => {
        // if there are mocks with relative paths, we need to rebase them to be relative to test module,
        // because mockery uses relative paths as they appear in test subjest module
        const mockPathArg = p.value.arguments[0] as namedTypes.Literal
        const mockPathArgValue = mockPathArg.value as string
        if (mockPathArgValue.startsWith('./') || mockPathArgValue.startsWith('../')) {
          if (maybeSubjectPath === undefined) {
            logWarning(
              'Cannot resolve mockery mock path because test subject module path could not be found',
              p
            )
            return
          }
          mockPathArg.value = path.join(path.dirname(maybeSubjectPath), mockPathArgValue)
        }
        const callee = p.node.callee as namedTypes.MemberExpression
        ;(callee.property as namedTypes.Identifier).name = 'mock'
        ;(callee.object as namedTypes.Identifier).name = 'jest'
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
