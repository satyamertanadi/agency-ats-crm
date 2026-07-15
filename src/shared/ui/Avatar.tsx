export interface AvatarProps {name:string;src?:string|null;size?:'sm'|'md'|'lg'}

export function Avatar({name,src,size='md'}:AvatarProps){
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase()||'A'
  return <span className={`avatar avatar-${size}`} aria-label={name}>{src?<img src={src} alt=""/>:initials}</span>
}
