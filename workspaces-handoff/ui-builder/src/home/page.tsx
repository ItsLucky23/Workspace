import useRouter from "src/_components/Router"

export const template = 'main'
export default function HomePage() {

  const router = useRouter();

  return (
    <div className="bg-background w-full h-full">
      Home Page
      <button
        className="bg-blue-500 px-6 py-1 rounded cursor-pointer"
        onClick={() => router("/sandbox")}
      >
        Click to go to sandbox cvdgjBHSZ
      </button>
    </div>
  )
}