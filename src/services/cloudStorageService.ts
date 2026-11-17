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
// 1. GOOGLE DRIVE INTEGRATION (Direct Google Account Sign-In + Drive API v3)
// ============================================================================
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const googleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export interface GoogleAccountProfile {
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

const GOOGLE_CLIENT_ID =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_GOOGLE_CLIENT_ID ||
  firebaseConfig.oAuthClientId ||
  '';

// Single-flight lock to prevent duplicate signInWithPopup calls from cancelling each other
let isSigningInGoogle = false;
let activeGoogleSignInPromise: Promise<{
  user: GoogleAccountProfile;
  accessToken: string;
} | null> | null = null;
let useDirectGisFallback = false;

// Strictly in-memory token cache (never stored in localStorage or sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedGoogleUser: GoogleAccountProfile | null = null;
let cachedDropboxAccessToken: string | null = null;
let cachedDropboxAccountName: string | null = null;

type GoogleAuthListener = {
  onSuccess?: (user: GoogleAccountProfile, token: string) => void;
  onFailure?: () => void;
  onSigningInChange?: (signingIn: boolean) => void;
};
const googleAuthListeners = new Set<GoogleAuthListener>();

function notifyGoogleAuthListeners(
  user: GoogleAccountProfile | null,
  token: string | null
) {
  googleAuthListeners.forEach((listener) => {
    if (user && token) {
      listener.onSuccess?.(user, token);
    } else {
      listener.onFailure?.();
    }
  });
}

function notifyGoogleSigningInState(signingIn: boolean) {
  googleAuthListeners.forEach((listener) => {
    listener.onSigningInChange?.(signingIn);
  });
}

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
  onAuthSuccess?: (user: GoogleAccountProfile, token: string) => void,
  onAuthFailure?: () => void,
  onSigningInChange?: (signingIn: boolean) => void
) => {
  const listenerEntry: GoogleAuthListener = {
    onSuccess: onAuthSuccess,
    onFailure: onAuthFailure,
    onSigningInChange,
  };
  googleAuthListeners.add(listenerEntry);

  onSigningInChange?.(isSigningInGoogle);

  if (cachedGoogleAccessToken && cachedGoogleUser) {
    onAuthSuccess?.(cachedGoogleUser, cachedGoogleAccessToken);
  } else if (!isSigningInGoogle) {
    onAuthFailure?.();
  }

  const unsubscribeFirebase = onAuthStateChanged(
    auth,
    async (user: User | null) => {
      if (user) {
        const profile: GoogleAccountProfile = {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        };
        cachedGoogleUser = profile;
        if (cachedGoogleAccessToken) {
          onAuthSuccess?.(profile, cachedGoogleAccessToken);
        } else if (!isSigningInGoogle) {
          onAuthFailure?.();
        }
      } else if (!cachedGoogleAccessToken && !isSigningInGoogle) {
        cachedGoogleUser = null;
        onAuthFailure?.();
      }
    }
  );

  return () => {
    googleAuthListeners.delete(listenerEntry);
    unsubscribeFirebase();
  };
};

async function fetchGoogleUserProfile(
  accessToken: string
): Promise<GoogleAccountProfile> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        user?: {
          displayName?: string;
          emailAddress?: string;
          photoLink?: string;
        };
      };
      if (data.user) {
        return {
          displayName: data.user.displayName || 'Google Drive User',
          email: data.user.emailAddress,
          photoURL: data.user.photoLink,
        };
      }
    }
  } catch {
    // Fallback below
  }
  return { displayName: 'Google Account' };
}

async function signInViaGoogleIdentityServices(): Promise<{
  user: GoogleAccountProfile;
  accessToken: string;
} | null> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google OAuth Client ID is not configured.');
  }

  const win = window as unknown as {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  };

  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error(
      'Google Sign-In service is still loading. Please tap "Sign in with Google" again.'
    );
  }

  const token = await new Promise<string | null>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (response) => {
        if (response.error) {
          if (
            response.error === 'access_denied' ||
            response.error === 'popup_closed_by_user'
          ) {
            resolve(null);
            return;
          }
          reject(
            new Error(
              response.error_description ||
                `Google Sign-In error: ${response.error}`
            )
          );
          return;
        }
        resolve(response.access_token || null);
      },
      error_callback: (err) => {
        if (err?.type === 'popup_closed') {
          resolve(null);
          return;
        }
        reject(
          new Error(
            err?.message ||
              'Google Sign-In popup was blocked by the browser. Please tap "Sign in with Google" to continue.'
          )
        );
      },
    });

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  });

  if (!token) return null;

  cachedGoogleAccessToken = token;
  cachedGoogleUser = await fetchGoogleUserProfile(token);
  notifyGoogleAuthListeners(cachedGoogleUser, cachedGoogleAccessToken);
  return { user: cachedGoogleUser, accessToken: cachedGoogleAccessToken };
}

export const isGoogleDriveSignInInProgress = (): boolean => {
  return isSigningInGoogle;
};

/**
 * Directs the user to sign in with their Google Account and returns a Google Drive OAuth access token.
 * Deduplicates concurrent calls so a single click never opens competing popups.
 */
export const googleDriveSignIn = (): Promise<{
  user: GoogleAccountProfile;
  accessToken: string;
} | null> => {
  if (activeGoogleSignInPromise) {
    return activeGoogleSignInPromise;
  }

  isSigningInGoogle = true;
  notifyGoogleSigningInState(true);

  activeGoogleSignInPromise = (async () => {
    try {
      if (useDirectGisFallback) {
        return await signInViaGoogleIdentityServices();
      }

      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error(
          'Could not obtain Google Drive permission token. Please sign in again and allow Google Drive access.'
        );
      }

      cachedGoogleAccessToken = credential.accessToken;
      cachedGoogleUser = {
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
      };
      notifyGoogleAuthListeners(cachedGoogleUser, cachedGoogleAccessToken);
      return { user: cachedGoogleUser, accessToken: cachedGoogleAccessToken };
    } catch (error: unknown) {
      const errCode =
        (error as { code?: string })?.code ||
        (error instanceof Error ? error.message : '');

      // User closed the popup or duplicate request was superseded
      if (
        errCode.includes('auth/popup-closed-by-user') ||
        errCode.includes('auth/cancelled-popup-request') ||
        errCode.includes('auth/user-cancelled')
      ) {
        return null;
      }

      // If Firebase Auth rejects the domain or environment, fall back to direct Google Identity Services
      if (
        errCode.includes('auth/unauthorized-domain') ||
        errCode.includes('auth/operation-not-supported-in-this-environment')
      ) {
        useDirectGisFallback = true;
        return await signInViaGoogleIdentityServices();
      }

      if (errCode.includes('auth/popup-blocked')) {
        throw new Error(
          'Your browser blocked the Google Sign-In window. Tap "Sign in with Google" below to open your Google Account.'
        );
      }

      const cleanMsg =
        error instanceof Error
          ? error.message.replace(/^Firebase:\s*/i, '')
          : 'Could not complete Google Sign-In. Please try again.';
      throw new Error(cleanMsg);
    } finally {
      isSigningInGoogle = false;
      activeGoogleSignInPromise = null;
      notifyGoogleSigningInState(false);
    }
  })();

  return activeGoogleSignInPromise;
};

export const getGoogleDriveAccessTokenSync = (): string | null => {
  return cachedGoogleAccessToken;
};

export const getGoogleDriveAccessToken = async (): Promise<string | null> => {
  return cachedGoogleAccessToken;
};

export const getCurrentGoogleUser = (): GoogleAccountProfile | null => {
  if (cachedGoogleUser) return cachedGoogleUser;
  if (auth.currentUser) {
    return {
      email: auth.currentUser.email,
      displayName: auth.currentUser.displayName,
      photoURL: auth.currentUser.photoURL,
    };
  }
  return null;
};

export const googleDriveSignOut = async (): Promise<void> => {
  try {
    await auth.signOut();
  } catch {
    // Ignore sign-out errors
  }
  cachedGoogleAccessToken = null;
  cachedGoogleUser = null;
  notifyGoogleAuthListeners(null, null);
};

/**
 * Lists PDF, Excel (.xlsx/.xls/.csv/.ods), Google Sheets, Word (.docx/.doc), Google Docs,
 * PowerPoint (.pptx/.ppt), Google Slides, eBooks (.epub/.kpf), HTML, and image files from Google Drive.
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
    "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
    "mimeType='application/vnd.ms-excel'",
    "mimeType='application/vnd.google-apps.spreadsheet'",
    "mimeType='text/csv'",
    "mimeType='application/vnd.oasis.opendocument.spreadsheet'",
    "mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    "mimeType='application/msword'",
    "mimeType='application/vnd.google-apps.document'",
    "mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation'",
    "mimeType='application/vnd.ms-powerpoint'",
    "mimeType='application/vnd.google-apps.presentation'",
    "mimeType='application/epub+zip'",
    "mimeType='text/html'",
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
    pageSize: '50',
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
 * Exports Google Sheets as .xlsx (preserving all sheets & rows) and Google Docs/Slides as .pdf.
 */
export async function downloadGoogleDriveFile(
  entry: CloudFileEntry
): Promise<File> {
  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) {
    throw new Error('AUTH_REQUIRED');
  }

  const isGoogleSheet =
    entry.mimeType === 'application/vnd.google-apps.spreadsheet';
  const isGoogleWorkspaceDoc = entry.mimeType.startsWith(
    'application/vnd.google-apps.'
  );

  const exportMime = isGoogleSheet
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/pdf';

  const url = isGoogleWorkspaceDoc
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.id)}/export?mimeType=${encodeURIComponent(exportMime)}`
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
  const finalMime = isGoogleWorkspaceDoc
    ? exportMime
    : entry.mimeType || blob.type || inferMimeFromFilename(entry.name);

  let finalName = entry.name;
  if (isGoogleSheet && !/\.(xlsx|xls|csv)$/i.test(finalName)) {
    finalName = `${finalName}.xlsx`;
  } else if (
    isGoogleWorkspaceDoc &&
    !isGoogleSheet &&
    !finalName.toLowerCase().endsWith('.pdf')
  ) {
    finalName = `${finalName}.pdf`;
  }

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
          file_extensions: [
            'pdf',
            'xlsx',
            'xls',
            'csv',
            'ods',
            'docx',
            'doc',
            'pptx',
            'ppt',
            'epub',
            'kpf',
            'html',
            'htm',
            'jpg',
            'jpeg',
            'png',
          ],
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
        /\.(pdf|xlsx|xls|xlsm|xlsb|ods|csv|tsv|docx|doc|odt|pptx|ppt|epub|kpf|mobi|fb2|html|htm|xhtml|jpg|jpeg|png|webp)$/i.test(
          e.name
        )
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
  if (lower.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.ods'))
    return 'application/vnd.oasis.opendocument.spreadsheet';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.pptx'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}
