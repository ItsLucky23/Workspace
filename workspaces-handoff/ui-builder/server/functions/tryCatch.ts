const tryCatch = async <T, P>(func: (values: P) => Promise<T> | T, params?: P): Promise<[any, T | null]> => {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    return [error, null];
  }
}

export { tryCatch }