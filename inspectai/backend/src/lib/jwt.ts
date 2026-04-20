import jwt from 'jsonwebtoken'

const SECRET  = process.env.JWT_SECRET ?? 'fallback-dev-secret'
const EXPIRES = '8h'

export interface JWTPayload {
  id:       string
  email:    string
  role:     string
  staffId:  string
  tenantId: string
  name:     string
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES })
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, SECRET) as JWTPayload
}
