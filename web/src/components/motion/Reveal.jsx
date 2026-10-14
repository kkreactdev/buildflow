import { useReveal } from './useReveal';
import './motion.css';

/** Fades and lifts its children in the first time they scroll into view. `index` staggers siblings (60 ms each, capped). */
export function Reveal({ children, index = 0, as: Tag = 'div', className = '', ...rest }) {
  const [ref, shown] = useReveal();
  return (
    <Tag ref={ref} className={`reveal ${shown ? 'is-in' : ''} ${className}`} style={{ '--i': Math.min(index, 8) }} {...rest}>
      {children}
    </Tag>
  );
}
