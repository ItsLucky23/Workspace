import { IncomingMessage, ServerResponse } from "http";
import { tryCatch } from "../functions/tryCatch";

type getParamsType = {
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  queryString?: string;
}

export default async function getParams({ method, req, res, queryString }: getParamsType): Promise<Record<string, any> | null> {

  if (method == "GET") {
    //? if get request we return the query string as an object
    return Object.fromEntries(new URLSearchParams(queryString || '')) as Record<string, string>;
  }

  //? if a POST, PUT or DELETE method we return the body as an object
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';

    //? we store the passed data chunks in a string
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      }); 

      req.on('end', async () => {
        //? here we parse the data depending on the content type
        //? if the content type is application/x-www-form-urlencoded we parse the data as a URLSearchParams object
        if (contentType.startsWith('application/x-www-form-urlencoded')) {
          const parseData = () => {
            const data = new URLSearchParams(body);
            return Object.fromEntries(data);
          }
          const [error, response] = await tryCatch(parseData)
          if (response) { resolve(response) }
          else { reject(error)}
        }

        //? if the content type is application/json we parse the data as a JSON object
        if (contentType.startsWith('application/json')) {
          const parseData = () => {
            return JSON.parse(body || '{}');
          }
          const [error, response] = await tryCatch(parseData)
          if (response) { resolve(response) }
          else { reject(error)}
        }

        resolve({ body });
      })

      req.on('error', (error) => {
        reject(error);
      })
    // }

  });
}