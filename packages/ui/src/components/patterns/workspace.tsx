import type { ReactNode } from 'react';
import { Box } from '../ui/box';
import { Text } from '../ui/text';
import { Heading } from '../ui/heading';
import { Pressable } from '../ui/pressable';
import { Button, ButtonText } from '../ui/button';
import { CheckIcon } from '../ui/icon';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-muted',
  success: 'bg-success-muted',
  warning: 'bg-accent',
  danger: 'bg-destructive-muted',
  accent: 'bg-primary',
};

const STATUS_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: 'text-secondary-foreground',
  success: 'text-success-muted-foreground',
  warning: 'text-accent-foreground',
  danger: 'text-destructive-muted-foreground',
  accent: 'text-primary-foreground',
};

const STATUS_DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-secondary-foreground',
  success: 'bg-success-muted-foreground',
  warning: 'bg-accent-foreground',
  danger: 'bg-destructive-muted-foreground',
  accent: 'bg-primary-foreground',
};

type SidebarItem = {
  key: string;
  label: string;
  active?: boolean;
  onPress?: () => void;
  suffix?: ReactNode;
};

type SidebarSection = {
  key: string;
  label?: string;
  items: SidebarItem[];
};

export function WorkspaceShell({
  sidebar,
  topbar,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box className="flex-1 min-h-0 flex-row bg-background">
      <Box className="hidden md:flex md:w-[200px] lg:w-[230px] shrink-0 border-r border-border bg-background">
        {sidebar}
      </Box>
      <Box className="flex-1 min-w-0 flex-col">
        <Box className="shrink-0">{topbar}</Box>
        <Box className="flex-1 min-h-0">{children}</Box>
      </Box>
    </Box>
  );
}

export function WorkspaceTopbar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <Box className="flex-row items-center justify-between gap-4 border-b border-border px-4 py-3 md:px-7">
      <Box className="flex-1 min-w-0">
        <Heading size="md" className="text-[15px] tracking-[-0.01em]">
          {title}
        </Heading>
        {subtitle ? (
          <Text className="mt-0.5 text-xs text-muted-foreground">{subtitle}</Text>
        ) : null}
      </Box>
      {right ? (
        <Box className="flex-row flex-wrap items-center justify-end gap-2">{right}</Box>
      ) : null}
    </Box>
  );
}

export function WorkspaceSidebar({
  title,
  sections,
  footer,
}: {
  title: string;
  sections: SidebarSection[];
  footer?: ReactNode;
}) {
  return (
    <Box className="flex-1 gap-0 px-3 pb-4 pt-[18px]">
      <Box className="mb-2 flex-row items-center gap-2.5 px-2.5 py-0.5">
        <Box className="h-7 w-7 rounded-full bg-primary items-center justify-center">
          <Text className="text-xs font-semibold text-primary-foreground">
            {title[0] ?? 'C'}
          </Text>
        </Box>
        <Heading size="sm" className="text-[15px] tracking-[-0.01em]">
          {title}
        </Heading>
      </Box>
      <Box>
        {sections.map((section) => (
          <Box key={section.key}>
            {section.label ? (
              <Text className="px-3 pb-2 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {section.label}
              </Text>
            ) : null}
            <Box className="gap-0.5">
              {section.items.map((item) => (
                <Pressable
                  key={item.key}
                  className={`min-h-8 flex-row items-center justify-between rounded-full px-3 py-2 ${
                    item.active
                      ? 'bg-primary'
                      : 'data-[hover=true]:bg-secondary data-[active=true]:bg-secondary'
                  }`}
                  onPress={item.onPress}
                >
                  <Text
                    className={`text-[13px] ${
                      item.active
                        ? 'font-semibold text-primary-foreground'
                        : 'font-medium text-secondary-foreground'
                    }`}
                  >
                    {item.label}
                  </Text>
                  {item.suffix ? <Box>{item.suffix}</Box> : null}
                </Pressable>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      {footer ? <Box className="mt-auto">{footer}</Box> : null}
    </Box>
  );
}

export function PageHeader({
  title,
  titleAccessory,
  description,
  actions,
}: {
  title: string;
  titleAccessory?: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Box className="flex-row flex-wrap items-end justify-between gap-4">
      <Box className="flex-1 min-w-[240px]">
        <Box className="flex-row flex-wrap items-center gap-2.5">
          <Heading size="lg" className="text-[27px] leading-8 tracking-[-0.02em]">
            {title}
          </Heading>
          {titleAccessory ? <Box>{titleAccessory}</Box> : null}
        </Box>
        {description ? (
          <Text className="mt-1 text-[13.5px] leading-5 text-muted-foreground">{description}</Text>
        ) : null}
      </Box>
      {actions ? (
        <Box className="flex-row flex-wrap items-center justify-end gap-2">{actions}</Box>
      ) : null}
    </Box>
  );
}

export function SurfaceCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box className="gap-5 rounded-[14px] border border-border bg-card p-5 lg:px-6 lg:py-[22px]">
      {title || subtitle || actions ? (
        <Box className="flex-row flex-wrap items-start justify-between gap-3">
          <Box className="flex-1 min-w-[180px]">
            {title ? (
              <Text className="text-[15px] font-bold text-foreground">{title}</Text>
            ) : null}
            {subtitle ? (
              <Text className="mt-1 text-[13px] leading-5 text-muted-foreground">{subtitle}</Text>
            ) : null}
          </Box>
          {actions ? (
            <Box className="flex-row flex-wrap items-center justify-end gap-2">{actions}</Box>
          ) : null}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

export function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <SurfaceCard>
      <Text className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
        {label}
      </Text>
      <Text className="text-2xl font-bold text-foreground">{value}</Text>
      {helper ? <Text className="text-xs text-muted-foreground">{helper}</Text> : null}
    </SurfaceCard>
  );
}

export function EmptyStateCard({
  title,
  description,
  ctaLabel,
  onPress,
}: {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
}) {
  return (
    <SurfaceCard>
      <Box className="gap-2">
        <Heading size="md">{title}</Heading>
        <Text className="text-sm text-muted-foreground">{description}</Text>
      </Box>
      {ctaLabel && onPress ? (
        <Button className="self-start" onPress={onPress}>
          <ButtonText>{ctaLabel}</ButtonText>
        </Button>
      ) : null}
    </SurfaceCard>
  );
}

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <Box
      className={`self-start flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${STATUS_TONE_CLASS[tone]}`}
    >
      <Box className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[tone]}`} />
      <Text className={`text-xs font-semibold ${STATUS_TEXT_CLASS[tone]}`}>
        {label}
      </Text>
    </Box>
  );
}

export function StepIndicator({
  steps,
  currentIndex,
}: {
  steps: readonly string[];
  currentIndex: number;
}) {
  return (
    <Box className="w-full flex-row items-center">
      {steps.map((step, index) => {
        const complete = index < currentIndex;
        const active = index === currentIndex;
        return (
          <Box
            key={step}
            className={`min-w-0 flex-row items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}
          >
            <Box className="min-w-0 flex-row items-center gap-2 md:gap-2.5">
              <Box
                className={`h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                  active
                    ? 'border-primary bg-primary'
                    : complete
                      ? 'border-success bg-success'
                      : 'border-input bg-card'
                }`}
              >
                {complete ? (
                  <CheckIcon className="h-3.5 w-3.5 text-success-foreground" />
                ) : (
                  <Text
                    className={`text-[12.5px] font-bold ${
                      active ? 'text-primary-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </Text>
                )}
              </Box>
              <Text
                className={`hidden text-[13.5px] md:flex ${
                  active
                    ? 'font-semibold text-foreground'
                    : complete
                      ? 'font-medium text-secondary-foreground'
                      : 'font-medium text-muted-foreground'
                }`}
              >
                {step}
              </Text>
            </Box>
            {index < steps.length - 1 ? (
              <Box
                className={`mx-2 h-[1.5px] min-w-3 flex-1 md:mx-4 ${complete ? 'bg-success' : 'bg-input'}`}
              />
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function StageTimeline({
  stages,
}: {
  stages: Array<{
    key: string;
    label: string;
    helper?: string;
    tone?: StatusTone;
  }>;
}) {
  return (
    <Box className="gap-2">
      {stages.map((stage) => (
        <Box key={stage.key} className="flex-row items-center justify-between gap-3">
          <Box>
            <Text className="text-sm font-medium text-foreground">{stage.label}</Text>
            {stage.helper ? (
              <Text className="text-xs text-muted-foreground">{stage.helper}</Text>
            ) : null}
          </Box>
          <StatusBadge label={stage.tone === 'success' ? 'Done' : 'Pending'} tone={stage.tone} />
        </Box>
      ))}
    </Box>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <Box className="bg-card border border-border rounded-xl p-3 flex-row items-center gap-2 flex-wrap">
      {children}
    </Box>
  );
}

export function SplitPane({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <Box className="flex-1 flex-row">
      <Box className="w-80 border-r border-border bg-card">{left}</Box>
      <Box className="flex-1">{right}</Box>
    </Box>
  );
}
