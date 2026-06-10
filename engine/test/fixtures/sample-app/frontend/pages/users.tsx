import React from "react";
import { useUsersQuery } from "../hooks/useUsers";
import { UserTable } from "../components/UserTable";

export default function UsersPage() {
  const { data } = useUsersQuery();
  return <UserTable users={data ?? []} />;
}
