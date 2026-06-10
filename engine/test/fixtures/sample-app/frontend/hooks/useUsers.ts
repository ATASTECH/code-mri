import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** GET /api/users/ — the frontend end of the golden cross-stack chain. */
export function useUsersQuery() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get("/users/");
      return res.data.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
      }));
    },
  });
}
