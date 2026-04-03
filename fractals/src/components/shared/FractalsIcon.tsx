export function FractalsIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="24,2 44,13 44,35 24,46 4,35 4,13" fill="rgba(124,77,255,0.2)" stroke="#7c4dff" strokeWidth="1.5"/>
      <polygon points="24,10 36,17 36,31 24,38 12,31 12,17" fill="rgba(124,77,255,0.15)" stroke="#b388ff" strokeWidth="1"/>
      <polygon points="24,18 30,21 30,27 24,30 18,27 18,21" fill="#7c4dff"/>
    </svg>
  )
}
