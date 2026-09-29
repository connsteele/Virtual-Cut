import logo from '../assets/virtual-cut-logo.svg';

export function Brand({ className = '' }: { className?: string }) {
  return <img className={className} src={logo} alt="" aria-hidden="true" draggable={false} />;
}
