import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

export function httpClient(config: AxiosRequestConfig = {}): AxiosInstance {
  return axios.create({
    timeout: 15_000,
    validateStatus: () => true,
    ...config
  });
}

export function isTransportError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response === undefined;
}
