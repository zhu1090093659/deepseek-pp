import type { SyncConfig } from '../types';

function buildUrl(config: SyncConfig, file?: string): string {
  const base = config.url.replace(/\/+$/, '');
  const path = config.remotePath.replace(/^\/+|\/+$/g, '');
  if (file) return `${base}/${path}/${file}`;
  return `${base}/${path}`;
}

function headers(config: SyncConfig, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: 'Basic ' + btoa(`${config.username}:${config.password}`),
    ...extra,
  };
}

export async function webdavTest(config: SyncConfig): Promise<void> {
  const url = config.url.replace(/\/+$/, '') + '/';
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: headers(config, { Depth: '0' }),
  });
  if (res.status === 401) throw new Error('认证失败，请检查用户名和密码');
  if (res.status === 403) throw new Error('访问被拒绝');
  if (res.status === 404) throw new Error('服务器地址不存在');
  if (res.status !== 207 && !res.ok) throw new Error(`连接失败 (HTTP ${res.status})`);
}

export async function webdavMkcol(config: SyncConfig): Promise<void> {
  const url = buildUrl(config) + '/';
  const res = await fetch(url, {
    method: 'MKCOL',
    headers: headers(config),
  });
  if (res.status === 405 || res.status === 301 || res.ok) return;
  if (res.status === 409) throw new Error(`无法创建远程目录，请确认父目录存在: ${config.remotePath}`);
  throw new Error(`创建远程目录失败 (HTTP ${res.status})`);
}

export async function webdavGet(config: SyncConfig, file: string): Promise<string | null> {
  const url = buildUrl(config, file);
  const res = await fetch(url, {
    method: 'GET',
    headers: headers(config),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`下载 ${file} 失败 (HTTP ${res.status})`);
  return res.text();
}

export async function webdavPut(config: SyncConfig, file: string, content: string): Promise<void> {
  const url = buildUrl(config, file);
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(config, { 'Content-Type': 'application/json; charset=utf-8' }),
    body: content,
  });
  if (!res.ok) throw new Error(`上传 ${file} 失败 (HTTP ${res.status})`);
}
