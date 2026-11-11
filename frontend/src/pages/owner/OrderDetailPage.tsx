import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../../components/ui';
import { TicketActions, TicketHeading, TicketSections, useOrderTicket } from './OrderDetail';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const ticket = useOrderTicket(id);

  if (!ticket.order)
    return (
      <Card>
        <p className="p-8 text-center text-[13px] text-ink-500">
          {ticket.loading ? 'Loading ticket…' : 'Ticket not found.'}
        </p>
      </Card>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/app/orders" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} /> All orders
      </Link>
      <Card className="space-y-5 p-5">
        <TicketHeading order={ticket.order} />
        <TicketSections order={ticket.order} />
        <div className="border-t border-ink-100 pt-4">
          <TicketActions ticket={ticket} />
        </div>
      </Card>
    </div>
  );
}
