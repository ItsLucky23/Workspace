import LoginForm from "src/_components/LoginForm";

export const template = 'plain';
export default function App() {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background">
        <LoginForm formType="register" />
      </div>
    )
}