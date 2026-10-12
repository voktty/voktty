import { request } from "node:http";

/** Fetch rejects some valid OS-assigned ports as forbidden browser ports. */
export function postHttp(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("aborted", () =>
          reject(new Error("Host response ended before completion")),
        );
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.once("error", reject);
    req.end(body);
  });
}
