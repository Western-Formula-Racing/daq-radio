import DataCard from "../components/DataCard";

function Dashboard() {
  return (
    <>
      <DataCard
        msgID="2012"
        name="TEST_DATA"
        category="CAT1"
        data={[
          { "Current 1": "3.57 A" },
          { "Current 2": "3.57 A" },
          { "Current 3": "3.57 A" },
          { "Current 4": "3.57 A" },
        ]}
      />

      <DataCard
        msgID="1006"
        name="TORCH_M1_V1"
        category="BMS/TORCH"
      />

    </>
  );
}

export default Dashboard;
