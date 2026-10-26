import type { OperationAdapter } from "./operationTransaction";
import { native } from "./native";
import { LOCAL_WORKSPACE } from "@/modules/workspace";

export const nativeOperationAdapter: OperationAdapter = {
  inspect: (path, workspace) =>
    native.operationInspect(path, workspace ?? LOCAL_WORKSPACE),
  writeFile: (path, content, expectedContent, workspace) =>
    native.operationWriteFile(
      path,
      content,
      expectedContent,
      workspace ?? LOCAL_WORKSPACE,
    ),
  createDirectory: (path, workspace) =>
    native.createDir(path, workspace ?? LOCAL_WORKSPACE),
  removeFile: (path, expectedContent, workspace) =>
    native.operationRemoveFile(
      path,
      expectedContent,
      workspace ?? LOCAL_WORKSPACE,
    ),
  removeEmptyDirectory: (path, workspace) =>
    native.operationRemoveEmptyDirectory(path, workspace ?? LOCAL_WORKSPACE),
};
