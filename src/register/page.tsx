import LoginForm from "src/_components/LoginForm";

export const template = 'plain';
export default function App() {
    return (
      <div className="w-full h-full overflow-y-auto bg-background">
        <div className="min-h-full w-full flex flex-col items-center justify-center p-4">
          <LoginForm formType="register" />
        </div>
      </div>
    )
}