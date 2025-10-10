import { NavLink } from "react-router";

interface InputProps {
  option: string;
  path: string;
  onClose: () => void;
}

function SidebarOption({ option, path, onClose }: Readonly<InputProps>) {
  return (
    <li>
      <NavLink
        onClick={onClose}
        className={({ isActive }) =>
          `flex h-20 items-center box-border px-3 !no-underline ${
            isActive
              ? "bg-option-select md:rounded-r-md md:mr-[-2%]"
              : "bg-option hover:bg-white/10 transition-colors duration-450"
          }`
        }
        to={path}
      >
        <span className="text-sidebarfg text-3xl font-heading leading-6 scale-y-75">
          {option}
        </span>
      </NavLink>
    </li>
  );
}

export default SidebarOption;
