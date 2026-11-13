import { CheckCircle2, History, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SaleForm } from '@/components/sales/SaleForm';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/datetime';
import { describeInstallments, formatCents } from '@/lib/money';
import type { Sale } from '@/types/database';

export function NewSalePage() {
  const toast = useToast();
  const [saved, setSaved] = useState<Sale | null>(null);
  const [formKey, setFormKey] = useState(0);

  function onSaved(sale: Sale) {
    setSaved(sale);
    toast.success('Venda registrada com sucesso!');
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nova venda" subtitle="Preencha os dados e registre em poucos segundos." />
      <Card>
        <CardBody className="pt-5 sm:pt-6">
          {saved ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-4 rounded-full bg-gold-50 p-4"><CheckCircle2 className="h-10 w-10 text-gold-500" /></div>
              <p className="font-display text-3xl text-navy">Venda registrada!</p>
              <p className="mt-3 text-navy/70"><strong className="text-navy">{saved.customer_name}</strong> · {formatCents(saved.total_cents)}</p>
              <p className="text-sm text-navy/55">{describeInstallments(saved.total_cents, saved.installments)} · {formatDateTime(saved.sold_at)}</p>
              <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button size="lg" onClick={() => { setSaved(null); setFormKey((k) => k + 1); }}><Plus className="h-4 w-4" /> Registrar outra venda</Button>
                <Link to="/historico"><Button size="lg" variant="outline" className="w-full"><History className="h-4 w-4" /> Ver histórico</Button></Link>
              </div>
            </div>
          ) : (
            <SaleForm key={formKey} onSaved={onSaved} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
