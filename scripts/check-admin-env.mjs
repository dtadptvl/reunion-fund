import argon2 from 'argon2';

const hash = process.env.ADMIN_PASSWORD_HASH || '';
console.log('ADMIN_USERNAME:', process.env.ADMIN_USERNAME || 'not set');
console.log('ADMIN_PASSWORD_HASH length:', hash.length);
console.log('Is dummy:', hash.includes('dummy'));

if (hash && !hash.includes('dummy')) {
  // test password from env
  const pwd = process.env.ADMIN_PASSWORD || '123456';
  argon2.verify(hash, pwd).then(valid => {
    console.log('Verify against ADMIN_PASSWORD valid:', valid);
  });
}
