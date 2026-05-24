import { db } from '@/db';
import { users, proxyKeys, keyEmailAccess } from '@/db/schema';
import * as jose from 'jose';

export async function createDbUser(clerkUserId: string, email: string) {
  // 1. Create User
  const [newUser] = await db.insert(users).values({
    clerkUserId,
    email,
  }).returning();

  // 2. Generate RSA Keypair for Service Account compatibility
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const publicKeyPem = await jose.exportSPKI(publicKey);

  // 3. Create the Default Agent Profile (Proxy Key)
  const proxyKeyString = `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`;
  const [newKey] = await db.insert(proxyKeys).values({
    userId: newUser.id,
    key: proxyKeyString,
    publicKey: publicKeyPem,
    label: 'Default Profile',
  }).returning();

  // 4. Grant this key access to the user's own email address
  await db.insert(keyEmailAccess).values({
    proxyKeyId: newKey.id,
    targetEmail: email,
  });

  return newUser;
}
