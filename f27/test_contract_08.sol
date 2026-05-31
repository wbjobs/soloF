pragma solidity ^0.8.0;

contract TestContract {
    mapping(address => uint256) public balances;
    uint256 public totalSupply;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    function withdrawUnchecked(uint256 _amount) public {
        require(balances[msg.sender] >= _amount);
        
        unchecked {
            balances[msg.sender] -= _amount;
            totalSupply -= _amount;
        }
        
        (bool success, ) = msg.sender.call{value: _amount}("");
        require(success);
    }

    function withdrawWithInternalCall(uint256 _amount) public {
        require(balances[msg.sender] >= _amount);
        
        (bool success, ) = msg.sender.call{value: _amount}("");
        require(success);
        
        _updateBalance(msg.sender, _amount);
    }

    function _updateBalance(address _user, uint256 _amount) internal {
        unchecked {
            balances[_user] -= _amount;
            totalSupply -= _amount;
        }
    }

    function safeArithmetic(uint256 x, uint256 y) public pure returns (uint256) {
        unchecked {
            return x + y;
        }
    }

    function complexLogic(uint256 x) public pure returns (uint256) {
        uint256 result = 0;
        
        unchecked {
            if (x > 100) {
                for (uint256 i = 0; i < 10; i++) {
                    result += i;
                }
            } else if (x > 50) {
                while (result < x) {
                    result *= 2;
                }
            }
        }
        
        return result;
    }
}
