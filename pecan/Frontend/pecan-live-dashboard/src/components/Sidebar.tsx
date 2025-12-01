import banner from "../assets/banner.png";
import settings from "../assets/settings.png";
import avatar from "../assets/avatar.png";
import SidebarOption from "./SidebarOption";
import { NavLink } from "react-router";

interface InputProps {
  isOpen: boolean;
  onClose: () => void;
}

function Sidebar({ onClose }: Readonly<InputProps>) {
  return (
    <div className="bg-sidebar w-full h-full flex flex-col justify-between overflow-y-auto overscroll-contain">
      <div>
        {/* When clicking the image the sidebar collapses, we'll see if we'll keep it that */}
        {/* NavLink for semantic purposes, clicking image goes home and closes sidebar */}
        <NavLink onClick={onClose} to={"/"}>
          <img className="my-10 cursor-pointer" src={banner} alt="banner" />
        </NavLink>
        {/* Could create a global function to close the sidebar and use it in the component rather than passing onClose in every time */}
        <ul className="p-0">
          <SidebarOption
            option="Dashboard"
            path="/dashboard"
            onClose={onClose}
          />
          <SidebarOption
            option="Accumulator"
            path="/accumulator"
            onClose={onClose}
          />
          <SidebarOption
            option="Chargecart"
            path="/chargecart"
            onClose={onClose}
          />
        </ul>
      </div>
      <footer className="font-footer flex flex-col space-y-8 mb-10">
        {/* Should go to /account*/}
        <NavLink
          to={"/account"}
          className="!no-underline text-md flex flex-row space-x-6 ml-4"
          onClick={onClose}
        >
          <img src={avatar} alt="avatar" width={30} height={30} />
          <span className="text-sidebarfg">Account</span>
        </NavLink>
        {/* Should go to /settings*/}
        <NavLink
          to={"/settings"}
          className="!no-underline flex flex-row space-x-6 text-md ml-4"
          onClick={onClose}
        >
          <img src={settings} alt="settings" width={30} height={30} />
          <span className="text-sidebarfg">Settings and Preferences</span>
        </NavLink>
      </footer>
    </div>
  );
}

export default Sidebar;
