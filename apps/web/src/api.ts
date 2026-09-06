import axios, { AxiosError } from "axios";

const MERCHANT_KEY = "gateway.merchantId";
const ADMIN_KEY = "gateway.adminKey";

export function storedMerchantId(): string | null {
  return localStorage.getItem(MERCHANT_KEY);
}

export function setMerchantId(id: string): void {
  localStorage.setItem(MERCHANT_KEY, id);
}

export function clearMerchantId(): void {
  localStorage.removeItem(MERCHANT_KEY);
}

export function storedAdminKey(): string {
  return sessionStorage.getItem(ADMIN_KEY) ?? "";
}

export function setAdminKey(key: string): void {
  sessionStorage.setItem(ADMIN_KEY, key);
}

export function clearAdminKey(): void {
  sessionStorage.removeItem(ADMIN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Array<{ field: string; message: string }>
  ) {
    super(message);
  }
}

interface ErrorBody {
  message?: string;
  details?: Array<{ field: string; message: string }>;
}

const client = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" }
});

client.interceptors.response.use(undefined, (error: AxiosError<ErrorBody>) => {
  const status = error.response?.status ?? 0;
  const body = error.response?.data;
  const message = body?.message ?? (status === 0 ? "The API is not reachable" : "Request failed");
  return Promise.reject(new ApiError(message, status, body?.details));
});

export const api = {
  get: async <T>(path: string): Promise<T> => (await client.get<T>(path)).data,

  post: async <T>(path: string, body?: unknown): Promise<T> =>
    (await client.post<T>(path, body ?? undefined)).data,

  downloadCsv: async (path: string): Promise<void> => {
    const { data } = await client.get<Blob>(path, { responseType: "blob" });
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "settlements.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
};

const adminHeaders = (key: string) => ({ Authorization: `Bearer ${key}` });

export const adminApi = {
  get: async <T>(path: string, key: string): Promise<T> =>
    (await client.get<T>(`/admin${path}`, { headers: adminHeaders(key) })).data,

  post: async <T>(path: string, key: string, body?: unknown): Promise<T> =>
    (await client.post<T>(`/admin${path}`, body ?? undefined, { headers: adminHeaders(key) })).data
};
