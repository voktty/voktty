import type { OperationAdapter } from "./operationTransaction";
import { native } from "./native";

export const nativeOperationAdapter: OperationAdapter = {
  inspect: (path) => native.operationInspect(path),
  writeFile: (path, content, expectedContent) =>
    native.operationWriteFile(path, content, expectedContent),
  createDirectory: (path) => native.createDir(path),
  removeFile: (path, expectedContent) =>
    native.operationRemoveFile(path, expectedContent),
  removeEmptyDirectory: (path) => native.operationRemoveEmptyDirectory(path),
};
