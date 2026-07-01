//? wrap your funcions in this function and check if the first value has a truthy value if it does than there is an error
//? if the first value is null than there is no error and you can access the second value wich is the response of your function
export default async function <T, P>(
  func: (values: P) => Promise<T> | T, 
  params?: P
): Promise<[unknown, T | null]> {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error: unknown) {
    return [error, null];
  }
}
