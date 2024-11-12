import { findParentOfType } from './recast-helpers'

export function isExpectSinonCall(obj, sinonMethods) {
  if (obj.type === 'CallExpression' && obj.callee.name === 'expect') {
    const args = obj.arguments
    if (args.length) {
      return (
        args[0].type === 'CallExpression' &&
        args[0].callee.type === 'MemberExpression' &&
        sinonMethods.includes(args[0].callee.property.name)
      )
    }
    return false
  } else if (obj.type === 'MemberExpression') {
    return isExpectSinonCall(obj.object, sinonMethods)
  }
}

export function isExpectSinonObject(obj, sinonMethods) {
  if (obj.type === 'CallExpression' && obj.callee.name === 'expect') {
    const args = obj.arguments
    if (args.length) {
      return (
        args[0].type === 'MemberExpression' &&
        sinonMethods.includes(args[0].property.name)
      )
    }
    return false
  } else if (obj.type === 'MemberExpression') {
    return isExpectSinonObject(obj.object, sinonMethods)
  }
}

export function getExpectArg(obj) {
  if (obj.type === 'MemberExpression') {
    return getExpectArg(obj.object)
  } else {
    return obj.arguments[0]
  }
}

export function modifyVariableDeclaration(nodePath, newNodePath) {
  const varName = findParentOfType(nodePath, 'VariableDeclarator')?.node?.id?.name
  const varDec = findParentOfType(nodePath, 'VariableDeclaration')
  if (!varDec || !varName) return

  // if var was initialized, insert transformed init expression (newNodePath) after variable declaration
  if (newNodePath !== null) {
    const parentBody = varDec.parentPath?.value
    if (parentBody) {
      const varDecPosition = parentBody.indexOf(varDec.node)
      if (varDecPosition === -1) {
        // no-op in case of invalid invariant
        return
      }
      parentBody.splice(varDecPosition + 1, 0, newNodePath)
    }
  }
  // remove var declaration, but not other vars if declaration is compound
  varDec.node.declarations = varDec.node.declarations.filter((d) => d.id.name !== varName)
  if (varDec.node.declarations.length === 0) {
    varDec.prune()
  }
}

export function expressionContainsProperty(node, memberName) {
  let current = node
  while (current) {
    if (current.property?.name === memberName) {
      return true
    }
    current = current.object
  }
  return false
}
