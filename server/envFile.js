import fs from 'fs';
import path from 'path';

const ENV_PATH = path.resolve(process.cwd(), '.env');

// .env内の指定キーの値を更新する（キーが無ければ末尾に追記する）。
// 取得したrefresh_tokenやポリシーIDをその場で.envへ保存するために使う。
export function updateEnvValue(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.endsWith('\n') || content === '' ? `${content}${line}\n` : `${content}\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  process.env[key] = value;
}
