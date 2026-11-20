import React from 'react';
import { AlertTriangle, Clock, ShieldAlert, Users, XCircle } from 'lucide-react';
import type { SimulationSummaryMetrics } from '../engine/types';

interface KpiStripProps {
  metrics: SimulationSummaryMetrics;
  activeLabel?: string;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ metrics, activeLabel }) => {
  const items = [
    {
      label: 'Delayed Flights',
      value: metrics.delayedFlights,
      subtext: `of ${metrics.totalFlights} scheduled · max ${metrics.maxFlightDelayMinutes}m`,
      tone: metrics.delayedFlights > 0 ? 'amber' : 'neutral',
      icon: Clock,
    },
    {
      label: 'Cancelled Flights',
      value: metrics.cancelledFlights,
      subtext: `${metrics.operatedFlights} flights operated`,
      tone: metrics.cancelledFlights > 0 ? 'red' : 'neutral',
      icon: XCircle,
    },
    {
      label: 'Total Arrival Delay',
      value: `${metrics.totalArrivalDelayMinutes.toLocaleString()}m`,
      subtext: `${metrics.passengerLegDelayMinutes.toLocaleString()} pax-leg min`,
      tone: metrics.totalArrivalDelayMinutes > 0 ? 'amber' : 'neutral',
      icon: AlertTriangle,
    },
    {
      label: 'Disrupted CX Pax-Events',
      value: metrics.disruptedConnectionPaxEvents.toLocaleString(),
      subtext: `${metrics.disruptedConnectionsCount} of 21 connections missed`,
      tone: metrics.disruptedConnectionPaxEvents > 0 ? 'red' : 'neutral',
      icon: Users,
    },
    {
      label: 'Crew Duty Violations',
      value: metrics.crewDutyViolations,
      subtext:
        metrics.totalCrewDutyOverageMinutes > 0
          ? `${metrics.totalCrewDutyOverageMinutes}m total overage`
          : `${metrics.evaluatedCrews} crews evaluated`,
      tone: metrics.crewDutyViolations > 0 ? 'red' : 'green',
      icon: ShieldAlert,
    },
  ] as const;

  const valueToneStyles = {
    neutral: 'text-[#252923]',
    amber: 'text-[#875B0E]',
    red: 'text-[#B84239]',
    green: 'text-[#3B5740]',
  };

  const iconToneStyles = {
    neutral: 'text-[#73766D]',
    amber: 'text-[#D69A32]',
    red: 'text-[#B84239]',
    green: 'text-[#65866B]',
  };

  const ruleToneStyles = {
    neutral: 'bg-[#DAD8CE]',
    amber: 'bg-[#D69A32]',
    red: 'bg-[#B84239]',
    green: 'bg-[#65866B]',
  };

  return (
    <section aria-label={activeLabel ?? 'Simulation Key Performance Indicators'}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 border border-[#DAD8CE] rounded-md bg-[#FFFEFA] divide-y sm:divide-y-0 sm:divide-x divide-[#DAD8CE] overflow-hidden">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="relative px-4 pt-3.5 pb-3 flex flex-col justify-between gap-2"
            >
              <span
                className={`absolute top-0 left-0 right-0 h-[2px] ${ruleToneStyles[item.tone]} transition-colors duration-200`}
                aria-hidden="true"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5D54]">
                  {item.label}
                </span>
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${iconToneStyles[item.tone]} transition-colors duration-200`}
                  aria-hidden="true"
                />
              </div>
              <div
                className={`text-2xl sm:text-[26px] font-semibold font-mono tabular-nums tracking-tight leading-none ${valueToneStyles[item.tone]} transition-colors duration-200`}
              >
                {item.value}
              </div>
              <div className="pt-1.5 border-t border-[#DAD8CE]/70 text-[11px] text-[#5F6259] font-mono tabular-nums">
                {item.subtext}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
