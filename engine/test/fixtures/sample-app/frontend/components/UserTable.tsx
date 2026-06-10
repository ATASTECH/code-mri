import React from "react";

interface User {
  id: number;
  email: string;
  name: string;
}

export function UserTable({ users }: { users: User[] }) {
  return (
    <table>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
            <td>{u.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
