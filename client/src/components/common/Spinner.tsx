interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' };

export function Spinner({ size = 'md', className }: Props) {
  return (
    <div className={`inline-block ${SIZES[size]} ${className ?? ''}`}>
      <div className="w-full h-full border-2 border-current border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
