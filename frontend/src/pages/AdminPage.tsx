import { useNavigate, useParams } from "react-router-dom";
import AdminPanel from "../AdminPanel";

export default function AdminPage() {
  const navigate = useNavigate();
  const { questionNumber } = useParams<{ questionNumber?: string }>();
  const focusQuestion = questionNumber ? parseInt(questionNumber) : null;

  const handleBack = () => {
    // If we came from the simulator editing a question, go back there
    if (focusQuestion) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return <AdminPanel onBack={handleBack} focusQuestion={focusQuestion} />;
}
