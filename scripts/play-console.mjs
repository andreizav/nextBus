#!/usr/bin/env node
/**
 * Zero-dependency Google Play Developer API v3 CLI helper for nextBus (`app.nextbus.twa`).
 *
 * Subcommands:
 *   status              Inspect tracks, releases, uploaded bundles, and store details.
 *   upload <aabPath>    Upload an Android App Bundle (.aab), assign to track, validate & commit.
 *
 * Usage:
 *   node scripts/play-console.mjs status
 *   node scripts/play-console.mjs upload android-twa/app-release-bundle.aab --track internal --status draft
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_KEY_PATH = path.join(REPO_ROOT, '.keystore', 'play-service-account.json');
const DEFAULT_PACKAGE = process.env.ANDROID_PACKAGE_NAME?.trim() || 'app.nextbus.twa';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_BASE = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command: positionals[0] || '', args: positionals.slice(1), flags };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function resolveKeyPath(flagKeyPath) {
  const candidate =
    typeof flagKeyPath === 'string' && flagKeyPath.trim()
      ? flagKeyPath.trim()
      : process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() || DEFAULT_KEY_PATH;
  return path.isAbsolute(candidate) ? candidate : path.resolve(REPO_ROOT, candidate);
}

function loadServiceAccount(keyPath) {
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Service account JSON key not found at: ${keyPath}\n` +
        `Place your Google Cloud service account key at .keystore/play-service-account.json ` +
        `or pass --key <path> / GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in service account key (${keyPath}): ${err.message}`);
  }
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new Error(
      `Service account JSON (${keyPath}) is missing required fields: client_email and private_key.`
    );
  }
  return parsed;
}

async function fetchAccessToken(sa) {
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: nowSec,
      exp: nowSec + 3600
    })
  );
  const unsignedJwt = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const assertion = `${unsignedJwt}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || !json?.access_token) {
    throw new Error(
      `OAuth2 token exchange failed (HTTP ${res.status}): ${JSON.stringify(json, null, 2)}`
    );
  }
  return json.access_token;
}

async function apiRequest(method, url, token, { body, contentType, isBinary = false } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isBinary ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(
      `Google Play API ${method} ${url} failed (HTTP ${res.status}): ${JSON.stringify(data, null, 2)}`
    );
    err.status = res.status;
    err.apiData = data;
    throw err;
  }
  return data;
}

function formatDiagnosticHint(err, saEmail, packageName) {
  if (err?.status === 403) {
    return (
      `\nHint (HTTP 403): Ensure BOTH steps are complete:\n` +
      `  1) "Google Play Android Developer API" is enabled in Google Cloud Console.\n` +
      `  2) "${saEmail}" is invited in Google Play Console -> Users and permissions, ` +
      `with "${packageName}" added under App permissions ("View app information" + release permissions).`
    );
  }
  if (err?.status === 404) {
    return (
      `\nHint (HTTP 404): App "${packageName}" was not found or is not visible to "${saEmail}". ` +
      `Check packageId and Play Console App permissions.`
    );
  }
  return '';
}

async function createEdit(packageName, token) {
  const url = `${API_BASE}/applications/${encodeURIComponent(packageName)}/edits`;
  const data = await apiRequest('POST', url, token, {
    body: {},
    contentType: 'application/json'
  });
  return data.id;
}

async function deleteEdit(packageName, editId, token) {
  if (!editId) return;
  const url = `${API_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`;
  await apiRequest('DELETE', url, token).catch(() => undefined);
}

async function runStatus({ packageName, sa, token }) {
  const base = `${API_BASE}/applications/${encodeURIComponent(packageName)}/edits`;
  let editId = '';
  try {
    editId = await createEdit(packageName, token);
    const editBase = `${base}/${encodeURIComponent(editId)}`;
    const [tracksData, bundlesData, detailsData, listingsData] = await Promise.all([
      apiRequest('GET', `${editBase}/tracks`, token),
      apiRequest('GET', `${editBase}/bundles`, token).catch((e) => ({ error: e.message })),
      apiRequest('GET', `${editBase}/details`, token).catch((e) => ({ error: e.message })),
      apiRequest('GET', `${editBase}/listings`, token).catch((e) => ({ error: e.message }))
    ]);

    console.log(`=== Google Play Console Status: ${packageName} ===`);
    console.log(`Service Account: ${sa.client_email}`);
    if (detailsData && !detailsData.error) {
      console.log(
        `App Details: defaultLanguage=${detailsData.defaultLanguage || '—'}, ` +
          `contactEmail=${detailsData.contactEmail || '—'}, website=${detailsData.contactWebsite || '—'}`
      );
    }

    const listings = Array.isArray(listingsData?.listings) ? listingsData.listings : [];
    if (listings.length) {
      console.log(`\nStore Listings (${listings.length}):`);
      for (const l of listings) {
        console.log(`  - [${l.language}] ${l.title || ''} — ${l.shortDescription || ''}`);
      }
    }

    const bundles = Array.isArray(bundlesData?.bundles) ? bundlesData.bundles : [];
    console.log(`\nUploaded App Bundles (${bundles.length}):`);
    if (!bundles.length) {
      console.log('  (none)');
    } else {
      for (const b of bundles) {
        console.log(`  - versionCode=${b.versionCode} sha256=${b.sha256 || '—'}`);
      }
    }

    const tracks = Array.isArray(tracksData?.tracks) ? tracksData.tracks : [];
    console.log(`\nTracks & Releases (${tracks.length}):`);
    if (!tracks.length) {
      console.log('  (no tracks initialized yet)');
    } else {
      for (const t of tracks) {
        console.log(`\n  [Track: ${t.track}]`);
        const releases = Array.isArray(t.releases) ? t.releases : [];
        if (!releases.length) {
          console.log('    (no releases)');
          continue;
        }
        for (const r of releases) {
          const vcs = Array.isArray(r.versionCodes) ? r.versionCodes.join(', ') : '—';
          const fraction = r.userFraction !== undefined ? ` userFraction=${r.userFraction}` : '';
          console.log(
            `    • status=${r.status || '—'} | versionCodes=[${vcs}] | name="${r.name || '—'}"${fraction}`
          );
          if (Array.isArray(r.releaseNotes) && r.releaseNotes.length) {
            for (const note of r.releaseNotes) {
              const preview = String(note.text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
              console.log(`      notes[${note.language}]: ${preview}`);
            }
          }
        }
      }
    }
  } finally {
    await deleteEdit(packageName, editId, token);
  }
}

async function runUpload({ packageName, aabPath, flags, token }) {
  if (!aabPath) {
    throw new Error('Missing <aabPath>. Example: node scripts/play-console.mjs upload android-twa/app-release-bundle.aab');
  }
  const resolvedAab = path.isAbsolute(aabPath) ? aabPath : path.resolve(REPO_ROOT, aabPath);
  if (!fs.existsSync(resolvedAab)) {
    throw new Error(`AAB file not found: ${resolvedAab}`);
  }

  const track = typeof flags.track === 'string' && flags.track.trim() ? flags.track.trim() : 'internal';
  const status = typeof flags.status === 'string' && flags.status.trim() ? flags.status.trim() : 'draft';
  const validateOnly = Boolean(flags['validate-only']);
  const releaseName = typeof flags.name === 'string' ? flags.name.trim() : undefined;

  const releaseNotes = [];
  if (typeof flags['notes-iw'] === 'string' && flags['notes-iw'].trim()) {
    releaseNotes.push({ language: 'iw-IL', text: flags['notes-iw'].trim() });
  }
  if (typeof flags['notes-ru'] === 'string' && flags['notes-ru'].trim()) {
    releaseNotes.push({ language: 'ru-RU', text: flags['notes-ru'].trim() });
  }
  if (typeof flags['notes-en'] === 'string' && flags['notes-en'].trim()) {
    releaseNotes.push({ language: 'en-US', text: flags['notes-en'].trim() });
  }

  let editId = '';
  let committed = false;
  try {
    editId = await createEdit(packageName, token);
    const editApiBase = `${API_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`;
    const aabBytes = fs.readFileSync(resolvedAab);

    console.log(`Uploading ${(aabBytes.length / 1024 / 1024).toFixed(2)} MiB (${resolvedAab}) to edit ${editId}...`);
    const bundleUrl = `${UPLOAD_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/bundles?uploadType=media`;
    const bundleResp = await apiRequest('POST', bundleUrl, token, {
      body: aabBytes,
      contentType: 'application/octet-stream',
      isBinary: true
    });
    const versionCode = String(bundleResp.versionCode);
    console.log(`Uploaded bundle: versionCode=${versionCode}, sha256=${bundleResp.sha256 || '—'}`);

    const releasePayload = {
      versionCodes: [versionCode],
      status
    };
    if (releaseName) releasePayload.name = releaseName;
    if (releaseNotes.length) releasePayload.releaseNotes = releaseNotes;

    await apiRequest('PUT', `${editApiBase}/tracks/${encodeURIComponent(track)}`, token, {
      body: { track, releases: [releasePayload] },
      contentType: 'application/json'
    });
    console.log(`Assigned versionCode=${versionCode} to track="${track}" (status="${status}").`);

    await apiRequest('POST', `${editApiBase}:validate`, token, {
      body: {},
      contentType: 'application/json'
    });
    console.log('Edit validated cleanly by Google Play API.');

    if (validateOnly) {
      console.log('--validate-only specified: skipping commit and cleaning up temporary edit.');
      return;
    }

    const commitResp = await apiRequest('POST', `${editApiBase}:commit`, token, {
      body: {},
      contentType: 'application/json'
    });
    committed = true;
    console.log(`Committed edit successfully: id=${commitResp.id}`);
  } finally {
    if (!committed) {
      await deleteEdit(packageName, editId, token);
    }
  }
}

async function main() {
  const { command, args, flags } = parseCliArgs(process.argv.slice(2));
  if (!command || command === 'help' || flags.help) {
    console.log(
      `Usage:\n` +
        `  node scripts/play-console.mjs status [--key <path>] [--package <id>]\n` +
        `  node scripts/play-console.mjs upload <aabPath> [--track internal|alpha|beta|production] [--status draft|completed] [--name <str>] [--notes-iw <str>] [--notes-ru <str>] [--notes-en <str>] [--validate-only]`
    );
    process.exit(command ? 0 : 1);
  }

  const packageName =
    typeof flags.package === 'string' && flags.package.trim() ? flags.package.trim() : DEFAULT_PACKAGE;
  const keyPath = resolveKeyPath(flags.key);
  let saEmail = '(unknown)';

  try {
    const sa = loadServiceAccount(keyPath);
    saEmail = sa.client_email;
    const token = await fetchAccessToken(sa);

    if (command === 'status') {
      await runStatus({ packageName, sa, token });
    } else if (command === 'upload') {
      await runUpload({ packageName, aabPath: args[0], flags, token });
    } else {
      console.error(`Unknown subcommand: "${command}". Expected "status" or "upload".`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    const hint = formatDiagnosticHint(err, saEmail, packageName);
    if (hint) console.error(hint);
    process.exit(1);
  }
}

await main();
