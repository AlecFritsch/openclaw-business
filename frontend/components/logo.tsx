import Image from 'next/image'
import { cn } from '@/lib/utils'

export const Logo = ({ className }: { className?: string }) => {
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <Image
                src="https://ucarecdn.com/df601530-a09a-4c18-b5e4-ed8072cfdf24/logo_transparent_dunkel.png"
                alt="OpenClaw Business"
                width={24}
                height={24}
                className="h-5 w-auto dark:hidden"
            />
            <Image
                src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png"
                alt="OpenClaw Business"
                width={24}
                height={24}
                className="h-5 w-auto hidden dark:block"
            />
            <span className="text-base font-medium tracking-tight">OpenClaw Business</span>
        </div>
    )
}

export const LogoIcon = ({ className }: { className?: string }) => {
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <Image
                src="https://ucarecdn.com/df601530-a09a-4c18-b5e4-ed8072cfdf24/logo_transparent_dunkel.png"
                alt="OpenClaw Business"
                width={20}
                height={20}
                className="h-5 w-auto dark:hidden"
            />
            <Image
                src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png"
                alt="OpenClaw Business"
                width={20}
                height={20}
                className="h-5 w-auto hidden dark:block"
            />
        </div>
    )
}
