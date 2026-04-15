import axios from 'axios'
import { supabase } from './supabase'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach the live Supabase session token on every request.
api.interceptors.request.use(async config => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Global error normalisation
api.interceptors.response.use(
  res => res,
  err => {
    const message = err.response?.data?.error ?? err.message ?? 'Unknown error'
    return Promise.reject(new Error(message))
  }
)
