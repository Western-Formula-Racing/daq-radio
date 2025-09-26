interface InputProps {
  option: string;
}

function SidebarOption({ option }: Readonly<InputProps>) {
  // Will add Link with React Router
  return (
    <li>
      <div className="bg-option h-20 flex items-center box-border px-3 hover:bg-option-hover transition-colors duration-600">
        <span className="text-sidebarfg text-3xl font-heading uppercase leading-6 scale-y-75">
          {option}
        </span>
      </div>
    </li>
  );
}

export default SidebarOption;
