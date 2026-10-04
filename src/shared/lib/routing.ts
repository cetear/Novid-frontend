export function safeReturn(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\/(chat|knowledge-bases|documents|approvals|tasks|memories|runs|admin\/users|settings)(\/[^?#]*)?(\?[^#]*)?$/.test(
      value,
    )
  )
    return '/chat'
  return value
}
