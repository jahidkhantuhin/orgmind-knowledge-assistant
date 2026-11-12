import type { ButtonHTMLAttributes } from 'react';

type IntegrationButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
};

export function IntegrationButton({
  variant = 'primary',
  className,
  ...props
}: IntegrationButtonProps) {
  return (
    <button
      className={['integration-button', `integration-button--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}
