import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// ============================================================================
// 1. GOOGLE DRIVE CONFIGURATION (1P Workspace OAuth via Firebase Auth)
// ============================================================================
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Flag to indicate if we are in the middle of a sign-in flow
let isSigningInGoogle = false;

// Strictly in-memory token cache (never stored in localStorage or sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedDropboxAccessToken: string | null = null;
let cachedDropboxAccountName: string | null = null;

export interface CloudFileEntry {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  modifiedTime?: string;
  webViewLink?: string;
  provider: 'google-drive' | 'dropbox';
  dropboxPathLower?: string;
}

export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedGoogleAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedGoogleAccessToken);
      } else if (!isSigningInGoogle) {
        cachedGoogleAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedGoogleAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

let inFlightGoogleSignInPromise: Promise<{
  user: User;
  accessToken: string;
} | null> | null = null;

export const googleDriveSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  if (inFlightGoogleSignInPromise) {
    return inFlightGoogleSignInPromise;
  }
  inFlightGoogleSignInPromise = (async () => {
    try {
      isSigningInGoogle = true;
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to get Google Drive access token from sign-in.');
      }
      cachedGoogleAccessToken = credential.accessToken;
      return { user: result.user, accessToken: cachedGoogleAccessToken };
    } catch (error) {
      console.error('Google Drive sign-in error:', error);
      throw error;
    } finally {
      isSigningInGoogle = false;
      inFlightGoogleSignInPromise = null;
    }
  })();
  return inFlightGoogleSignInPromise;
};

export const getGoogleDriveAccessToken = async (): Promise<string | null> => {
  return cachedGoogleAccessToken;
};

export const getCurrentGoogleUser = (): User | null => {
  return auth.currentUser;
};

export const googleDriveSignOut = async (): Promise<void> => {
  await auth.signOut();
  cachedGoogleAccessToken = null;
};

/**
 * Lists PDF, Word (.docx/.doc), Google Docs, and image files from the user's Google Drive.
 */
export async function listGoogleDriveFiles(
  searchQuery = ''
): Promise<CloudFileEntry[]> {
  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) {
    throw new Error('AUTH_REQUIRED');
  }

  const mimeConditions = [
    "mimeType='application/pdf'",
    "mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    "mimeType='application/msword'",
    "mimeType='application/vnd.google-apps.document'",
    "mimeType='image/jpeg'",
    "mimeType='image/png'",
    "mimeType='image/webp'",
  ].join(' or ');

  let q = `trashed = false and (${mimeConditions})`;
  const trimmed = searchQuery.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const params = new URLSearchParams({
    q,
    pageSize: '40',
    orderBy: 'modifiedTime desc',
    fields:
      'files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    cachedGoogleAccessToken = null;
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.size ? Number(f.size) : undefined,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    provider: 'google-drive',
  }));
}

/**
 * Downloads a file from Google Drive and returns a standard browser File object.
 * If the file is a Google Doc, exports it directly as a PDF.
 */
export async function downloadGoogleDriveFile(
  entry: CloudFileEntry
): Promise<File> {
  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) {
    throw new Error('AUTH_REQUIRED');
  }

  const isGoogleDoc = entry.mimeType.startsWith(
    'application/vnd.google-apps.'
  );
  const url = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.id)}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.id)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    cachedGoogleAccessToken = null;
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    throw new Error(
      `Failed to download "${entry.name}" from Google Drive (${res.status}).`
    );
  }

  const blob = await res.blob();
  const finalMime = isGoogleDoc ? 'application/pdf' : entry.mimeType || blob.type || 'application/pdf';
  const finalName =
    isGoogleDoc && !entry.name.toLowerCase().endsWith('.pdf')
      ? `${entry.name}.pdf`
      : entry.name;

  return new File([blob], finalName, { type: finalMime });
}

/**
 * Uploads (exports) a file to Google Drive using multipart upload.
 */
export async function uploadFileToGoogleDrive(
  filename: string,
  bytes: Uint8Array,
  mimeType = 'application/pdf'
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) {
    throw new Error('AUTH_REQUIRED');
  }

  const metadata = {
    name: filename,
    mimeType,
  };

  const boundary = `elimikapdf_boundary_${Date.now()}`;
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(metaPart);
  const footerBytes = encoder.encode(closeDelimiter);

  const multipartBody = new Uint8Array(
    headerBytes.byteLength + bytes.byteLength + footerBytes.byteLength
  );
  multipartBody.set(headerBytes, 0);
  multipartBody.set(bytes, headerBytes.byteLength);
  multipartBody.set(footerBytes, headerBytes.byteLength + bytes.byteLength);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (res.status === 401 || res.status === 403) {
    cachedGoogleAccessToken = null;
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to upload "${filename}" to Google Drive: ${errText}`);
  }

  return (await res.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
  };
}

// ============================================================================
// 2. DROPBOX INTEGRATION (3P OAuth 2.0 + Dropbox API v2)
// ============================================================================
export const getDropboxAccessToken = (): string | null => {
  return cachedDropboxAccessToken;
};

export const setDropboxAccessToken = (token: string | null): void => {
  cachedDropboxAccessToken = token ? token.trim() : null;
  if (!cachedDropboxAccessToken) {
    cachedDropboxAccountName = null;
  }
};

export const getDropboxAccountName = (): string | null => {
  return cachedDropboxAccountName;
};

export const dropboxSignOut = (): void => {
  cachedDropboxAccessToken = null;
  cachedDropboxAccountName = null;
};

export async function fetchDropboxAccountProfile(): Promise<string | null> {
  if (!cachedDropboxAccessToken) return null;
  try {
    const res = await fetch(
      'https://api.dropboxapi.com/2/users/get_current_account',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cachedDropboxAccessToken}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      name?: { display_name?: string };
      email?: string;
    };
    cachedDropboxAccountName =
      data.name?.display_name || data.email || 'Dropbox Account';
    return cachedDropboxAccountName;
  } catch {
    return null;
  }
}

export async function listDropboxFiles(
  searchQuery = ''
): Promise<CloudFileEntry[]> {
  if (!cachedDropboxAccessToken) {
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  const trimmed = searchQuery.trim();
  if (trimmed) {
    const res = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cachedDropboxAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: trimmed,
        options: {
          max_results: 40,
          file_extensions: ['pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png'],
        },
      }),
    });

    if (res.status === 401) {
      cachedDropboxAccessToken = null;
      throw new Error('DROPBOX_AUTH_REQUIRED');
    }
    if (!res.ok) {
      throw new Error(`Dropbox search error (${res.status})`);
    }
    const data = (await res.json()) as {
      matches?: Array<{
        metadata?: {
          metadata?: {
            '.tag': string;
            id: string;
            name: string;
            path_lower?: string;
            path_display?: string;
            size?: number;
            server_modified?: string;
          };
        };
      }>;
    };

    return (data.matches || [])
      .map((m) => m.metadata?.metadata)
      .filter((item): item is NonNullable<typeof item> =>
        Boolean(item && item['.tag'] === 'file')
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: inferMimeFromFilename(f.name),
        sizeBytes: f.size,
        modifiedTime: f.server_modified,
        dropboxPathLower: f.path_lower || f.path_display || `/${f.name}`,
        provider: 'dropbox',
      }));
  }

  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cachedDropboxAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: '',
      recursive: true,
      limit: 60,
    }),
  });

  if (res.status === 401) {
    cachedDropboxAccessToken = null;
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  if (!res.ok) {
    throw new Error(`Dropbox list_folder error (${res.status})`);
  }

  const data = (await res.json()) as {
    entries?: Array<{
      '.tag': string;
      id: string;
      name: string;
      path_lower?: string;
      path_display?: string;
      size?: number;
      server_modified?: string;
    }>;
  };

  return (data.entries || [])
    .filter(
      (e) =>
        e['.tag'] === 'file' &&
        /\.(pdf|docx|doc|jpg|jpeg|png|webp)$/i.test(e.name)
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: inferMimeFromFilename(f.name),
      sizeBytes: f.size,
      modifiedTime: f.server_modified,
      dropboxPathLower: f.path_lower || f.path_display || `/${f.name}`,
      provider: 'dropbox',
    }));
}

export async function downloadDropboxFile(
  entry: CloudFileEntry
): Promise<File> {
  if (!cachedDropboxAccessToken) {
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  const dropboxArg = JSON.stringify({
    path: entry.dropboxPathLower || entry.id,
  });

  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cachedDropboxAccessToken}`,
      'Dropbox-API-Arg': dropboxArg,
    },
  });

  if (res.status === 401) {
    cachedDropboxAccessToken = null;
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  if (!res.ok) {
    throw new Error(
      `Failed to download "${entry.name}" from Dropbox (${res.status}).`
    );
  }

  const blob = await res.blob();
  const mimeType = inferMimeFromFilename(entry.name);
  return new File([blob], entry.name, { type: mimeType });
}

export async function uploadFileToDropbox(
  filename: string,
  bytes: Uint8Array
): Promise<{ id: string; name: string; pathDisplay: string }> {
  if (!cachedDropboxAccessToken) {
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  const cleanName = filename.replace(/[/\\]/g, '_');
  const targetPath = `/ElimikaPDF/${cleanName}`;

  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cachedDropboxAccessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: targetPath,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    },
    body: new Uint8Array(bytes),
  });

  if (res.status === 401) {
    cachedDropboxAccessToken = null;
    throw new Error('DROPBOX_AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to upload "${filename}" to Dropbox: ${errText}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    path_display?: string;
  };

  return {
    id: data.id,
    name: data.name || cleanName,
    pathDisplay: data.path_display || targetPath,
  };
}

function inferMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}
