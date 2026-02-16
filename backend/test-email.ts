import { sendTestEmail } from './emailService';

async function testEmail() {
  const result = await sendTestEmail('test@example.com');
  console.log('Test result:', result);
}

testEmail();