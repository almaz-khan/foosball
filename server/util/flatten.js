const flatten = (object, separator = '.') => {

  const isValidObject = value => {
    if (!value) {
      return false
    }

    const isArray  = Array.isArray(value)
    const isObject = Object.prototype.toString.call(value) === '[object Object]'
    const hasKeys  = !!Object.keys(value).length

    return !isArray && isObject && hasKeys
  }

  const walker = (child, path = []) => {

    return Object.assign({}, ...Object.keys(child).map(key => isValidObject(child[key])
      ? walker(child[key], path.concat([key]))
      : { [path.concat([key]).join(separator)] : child[key] })
    )
  }

  return Object.assign({}, walker(object))
}

module.exports = flatten
