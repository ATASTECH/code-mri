import axios from "axios";

/** Shared axios client. baseURL is the cross-stack prefix the linker resolves. */
export const api = axios.create({ baseURL: "/api" });
