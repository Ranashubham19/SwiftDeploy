import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env')
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    console.log(`Loading environment from: ${candidate}`);
    const result = dotenv.config({ path: candidate });
    
    if (result.error) {
      console.log(`Error loading .env with dotenv:`, result.error);
      // Manual parsing as fallback
      const envContent = fs.readFileSync(candidate, 'utf8');
      const lines = envContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith('\'') && value.endsWith('\''))) {
          value = value.slice(1, -1);
        }
        
        // Only set if not already set
        if (process.env[key] === undefined) {
          process.env[key] = value;
          console.log(`Set ${key} from manual parsing`);
        }
      }
    } else {
      console.log(`Successfully loaded .env with dotenv: ${candidate}`);
    }
  }
}

export default process.env;
