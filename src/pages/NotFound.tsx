import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="font-display text-6xl text-gold-400">404</p>
      <p className="mt-2 text-navy/60">Página não encontrada.</p>
      <Link to="/" className="mt-6"><Button variant="outline">Voltar ao painel</Button></Link>
    </div>
  );
}
