interface InputProps {
  trigger: () => void;
}

function Hamburger({ trigger }: Readonly<InputProps>) {
  return (
    <button
      onClick={trigger}
      className="fixed top-2 left-2 h-8 w-10 relative box-border p-0"
    >
      <span className="absolute left-2 right-2 block h-1 bg-white rounded"></span>
      <span className="absolute left-2 right-2 block h-1 bg-white mt-2 rounded"></span>
      <span className="absolute left-2 right-2 block h-1 bg-white mt-3 rounded"></span>
    </button>
  );
}

export default Hamburger;
