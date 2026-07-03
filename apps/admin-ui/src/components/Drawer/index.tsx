import { Cross1Icon } from '@radix-ui/react-icons'
import clsx from 'clsx'
import './Drawer.css'

function Drawer({ children }: { children: React.ReactNode }) {
	return (
		<div
			id='nav-content'
			className={clsx(
				'drawer-menu',
				'bg-white border rounded-r-xl w-80 shadow-2xl',
			)}
		>
			<div className='relative w-full h-full'>
				<label
					htmlFor='nav-toggle'
					className='absolute top-4 right-4 hover:bg-gray-200 rounded cursor-pointer p-1.5'
				>
					<Cross1Icon className='w-4 h-4' />
				</label>
				{children}
			</div>
		</div>
	)
}

export function DrawerButton({
	children,
	renderDrawerContent,
	className = '',
}: {
	children: React.ReactNode
	renderDrawerContent: React.ReactNode
	className?: string
}) {
	return (
		<>
			<input type='checkbox' id='nav-toggle' className='menu-checkbox hidden' />
			<label
				htmlFor='nav-toggle'
				className={clsx(
					className,
					'drawer-icon',
					'w-[30px] h-[30px] p-[5px] rounded border border-black border-opacity-10 justify-center items-center gap-2.5 inline-flex cursor-pointer hover:bg-slate-200 hover:border-gray-500',
				)}
			>
				{children}
			</label>
			{/* <label htmlFor='nav-toggle' className='menu-background' /> */}
			<Drawer>{renderDrawerContent}</Drawer>
		</>
	)
}
