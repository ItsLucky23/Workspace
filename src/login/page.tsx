import { Link } from "react-router-dom";

import { useTranslator } from "@luckystack/core/client";
import AuthShell from "src/_components/AuthShell";
import LoginForm from "src/_components/LoginForm";

export const template = 'plain';
export default function App() {
  const translate = useTranslator();
  return (
    <AuthShell
      footer={
        <>
          {translate({ key: 'login.noAccount' })}
          <Link to="/register" className="text-primary hover:text-primary-hover font-medium cursor-pointer">
            {translate({ key: 'login.createAccount' })}
          </Link>
        </>
      }
    >
      <LoginForm formType="login" />
    </AuthShell>
  )
}
