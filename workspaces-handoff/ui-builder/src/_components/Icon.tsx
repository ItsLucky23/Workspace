interface Props {
	name: string,
	size?: string,
	weight?: string,
  customClasses?: string,
  onClick?: () => void
}

export default function Icon({ name, size, weight, customClasses, onClick }: Props) {
  if (!name) return null

  return (
    <span
      style={{ fontSize: size ? size : '20px', fontWeight: weight ? weight : 'lighter' }}
      className={`material-icons select-none ${customClasses}`}
      onClick={onClick}
    >
      {name}
    </span>
  )
}