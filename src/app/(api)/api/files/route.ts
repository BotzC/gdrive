import { NextRequest, NextResponse } from "next/server";
import apiConfig from "config/api.config";
import getSearchParams from "utils/getSearchParams";
import {
  ErrorResponse,
  FilesResponse,
} from "types/googleapis";
import driveClient from "utils/driveClient";
import {
  ExtendedError,
  hiddenFiles,
} from "utils/driveHelper";
import { shortEncrypt } from "utils/encryptionHelper";

export async function GET(request: NextRequest) {
  const _start = Date.now();
  try {
    const { pageToken, banner } = getSearchParams(
      request.url,
      ["pageToken", "banner"],
    );

    const query: string[] = [
      "trashed = false",
      "'me' in owners",
      `parents = '${apiConfig.files.rootFolder}'`,
    ];
    const fetchFolderContents =
      await driveClient.files.list({
        q: `${query.join(" and ")}`,
        fields: `files(${apiConfig.files.field}), nextPageToken`,
        orderBy: apiConfig.files.orderBy,
        pageSize: apiConfig.files.itemsPerPage,
        pageToken: pageToken || undefined,
      });

    const readmeFile = fetchFolderContents.data.files?.find(
      (file) =>
        file.name === apiConfig.files.specialFile.readme,
    );
    const bannerFile = fetchFolderContents.data.files?.find(
      (file) =>
        file.name?.startsWith(
          apiConfig.files.specialFile.banner,
        ) && file.mimeType?.startsWith("image/"),
    );

    if (banner === "1") {
      if (!bannerFile) {
        throw new ExtendedError(
          "Banner not found.",
          404,
          "notFound",
        );
      }
      if (
        Number(bannerFile.size) >
        apiConfig.files.download.maxFileSize
      ) {
        return NextResponse.redirect(
          bannerFile.webContentLink as string,
          { status: 302 },
        );
      }

      return NextResponse.redirect(
        `${apiConfig.basePath}/api/banner?id=${shortEncrypt(
          bannerFile.id as string,
        )}`,
        {
          status: 302,
        },
      );
    }

    const folderList =
      fetchFolderContents.data.files
        ?.filter(
          (file) =>
            file.mimeType ===
            "application/vnd.google-apps.folder",
        )
        .map((file) => ({
          ...file,
          id: shortEncrypt(file.id as string),
        })) || [];
    const fileList =
      fetchFolderContents.data.files
        ?.filter(
          (file) =>
            file.mimeType !==
              "application/vnd.google-apps.folder" &&
            !hiddenFiles.some((hiddenFile) =>
              file.name?.startsWith(hiddenFile),
            ),
        )
        .map((file) => ({
          ...file,
          id: shortEncrypt(file.id as string),
          webContentLink:
            shortEncrypt(file.webContentLink as string) ||
            undefined,
        })) || [];

    const payload: FilesResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - _start,
      folders: folderList,
      files: fileList,
      isReadmeExists: !!readmeFile,
      isBannerExists: !!bannerFile,
      nextPageToken:
        fetchFolderContents.data.nextPageToken || undefined,
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": apiConfig.cache,
      },
    });
  } catch (error: any) {
    const payload: ErrorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - _start,
      code: error.code || 500,
      errors: {
        message:
          error.errors?.[0].message ||
          error.message ||
          "Unknown error",
        reason:
          error.errors?.[0].reason ||
          error.cause ||
          "internalError",
      },
    };

    return NextResponse.json(payload, {
      status: payload.code || 500,
    });
  }
}
